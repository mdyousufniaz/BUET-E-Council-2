import os
from functools import lru_cache
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# Pin PyTorch threads to CPU core count to prevent thread thrashing under concurrency
torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "2")))

MODEL_NAME = os.environ.get("MODEL_NAME", "BAAI/bge-m3")

app = FastAPI(title="BUET E-Council Embedding Service")
model: SentenceTransformer | None = None


@app.on_event("startup")
def load_model():
    global model
    model = SentenceTransformer(MODEL_NAME)


# Cache embeddings for user queries up to 10,000 distinct strings (consumes < 45 MB RAM)
@lru_cache(maxsize=10000)
def compute_cached_embedding(text: str) -> tuple:
    vector = model.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0]
    return tuple(vector.tolist())


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

    embeddings = []
    uncached_texts = []
    uncached_indices = []

    for idx, text in enumerate(payload.texts):
        # Cache single-query strings (search queries are typically short)
        if len(text) < 256:
            cached_vec = compute_cached_embedding(text)
            embeddings.append(list(cached_vec))
        else:
            embeddings.append(None)
            uncached_texts.append(text)
            uncached_indices.append(idx)

    # Compute batch embeddings for cache misses or long documents
    if uncached_texts:
        batch_size = int(os.environ.get("EMBED_BATCH_SIZE", "4"))
        vectors = model.encode(
            uncached_texts,
            batch_size=batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
        for original_idx, vec in zip(uncached_indices, vectors):
            embeddings[original_idx] = vec.tolist()

    return EmbedResponse(embeddings=embeddings)

