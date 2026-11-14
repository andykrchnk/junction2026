import httpx
from schemas import WorkerResponse


class WorkerFailure(Exception):
    pass


def predict(url, key, image, model):
    try:
        with httpx.Client(
            timeout=httpx.Timeout(180, connect=10), follow_redirects=False
        ) as client:
            response = client.post(
                url.rstrip("/") + "/v1/predictions",
                params={"model": model, "response_format": "json"},
                headers={"x-api-key": key},
                files={"image": ("drawing.png", image, "image/png")},
            )
            response.raise_for_status()
            result = WorkerResponse.model_validate(response.json())
            if result.model.get("name") != model:
                raise ValueError("Unexpected worker identity")
            return result
    except (httpx.HTTPError, ValueError) as exc:
        raise WorkerFailure("Worker unavailable or response invalid") from exc
