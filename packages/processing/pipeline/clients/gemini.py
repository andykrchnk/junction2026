import hashlib
import json
import math
import time
from pathlib import Path
import httpx


class VerificationFailure(Exception):
    pass


def validate(result, questions):
    answers = result.get("answers", {})
    if set(answers) != set(questions):
        raise ValueError("Unexpected answer keys")
    for name, q in questions.items():
        a = answers[name]
        if a.get("type") != q["type"]:
            raise ValueError("Unexpected answer type")
        if q["type"] == "noul":
            value = a.get("noul")
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not 0.01 <= value <= 0.99
            ):
                raise ValueError("Invalid binary probability")
        else:
            probs = a["probabilities"]
            if set(probs) != set(q["criteria"]) or a["choice"] not in probs:
                raise ValueError("Unexpected class names")
            if any(
                isinstance(v, bool)
                or not isinstance(v, (int, float))
                or not math.isfinite(v)
                or not 0 <= v <= 1
                for v in probs.values()
            ):
                raise ValueError("Invalid probabilities")
            if abs(sum(probs.values()) - 1) > 0.025 or not 0 <= a["confidence"] <= 1:
                raise ValueError("Invalid probability distribution")
            if abs(a["confidence"] - probs[a["choice"]]) > 0.025 or probs[
                a["choice"]
            ] + 0.025 < max(probs.values()):
                raise ValueError("Inconsistent selected confidence")
    return answers


class Gemini:
    def __init__(self, settings, directory, deadline=None):
        self.settings = settings
        self.deadline = (
            deadline
            if deadline is not None
            else time.monotonic() + settings.deadline_seconds
        )
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.client = httpx.Client(
            timeout=settings.gemini_timeout, follow_redirects=False
        )

    def close(self):
        self.client.close()

    def decide(self, parts, questions):
        payload = {"model": self.settings.model, "input": parts, "questions": questions}
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True).encode()
        ).hexdigest()
        path = self.directory / (digest + ".json")
        try:
            if path.exists():
                result = json.loads(path.read_text())
            else:
                # One provider budget across all pages, including close-up rechecks.
                if not self.settings.gemini_slots.acquire(
                    timeout=max(0, self.deadline - time.monotonic())
                ):
                    raise VerificationFailure("Verification capacity deadline exceeded")
                try:
                    if time.monotonic() >= self.deadline:
                        raise VerificationFailure("Verification capacity deadline exceeded")
                    response = self.client.post(
                        "https://generativelanguage.googleapis.com/v1beta/decisions",
                        headers={"x-goog-api-key": self.settings.gemini_key},
                        json=payload,
                    )
                    response.raise_for_status()
                    result = response.json()
                finally:
                    self.settings.gemini_slots.release()
            answers = validate(result, questions)
            path.write_text(json.dumps(result))
            return answers
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            raise VerificationFailure(
                "Verifier unavailable or returned invalid data"
            ) from exc
