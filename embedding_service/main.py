import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL_NAME = os.environ.get("MODEL_NAME", "BAAI/bge-m3")

app = FastAPI(title="BUET E-Council Embedding Service")
model: SentenceTransformer | None = None


@app.on_event("startup")
def load_model():
    global model
    model = SentenceTransformer(MODEL_NAME)


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/embed", response_model=EmbedResponse)
def embed(payload: EmbedRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    if not payload.texts:
        return EmbedResponse(embeddings=[])
    vectors = model.encode(payload.texts, convert_to_numpy=True, normalize_embeddings=True)
    return EmbedResponse(embeddings=vectors.tolist())
