import logging

import httpx
from schemas import WorkerResponse


class WorkerFailure(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.status_code = status_code


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
            if response.status_code == 503:
                raise WorkerFailure("Model worker busy or unavailable; retry later", 503)
            if response.status_code == 504:
                raise WorkerFailure("Model worker timed out", 504)
            response.raise_for_status()
            result = WorkerResponse.model_validate(response.json())
            if result.model.get("name") != model:
                raise ValueError("Unexpected worker identity")
            return result
    except httpx.TimeoutException as exc:
        logging.getLogger("uvicorn.error").warning("Worker timed out model=%s", model)
        raise WorkerFailure("Model worker timed out", 504) from exc
    except (httpx.HTTPError, ValueError) as exc:
        logging.getLogger("uvicorn.error").warning(
            "Worker failed model=%s error_type=%s", model, type(exc).__name__
        )
        raise WorkerFailure("Worker unavailable or response invalid") from exc
