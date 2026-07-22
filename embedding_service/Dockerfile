FROM python:3.11-slim

WORKDIR /app

# CPU-only torch build (the default PyPI wheel pulls in CUDA and is ~2GB
# larger; this service never touches a GPU).
RUN pip install --no-cache-dir torch>=2.6.0 --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model weights into the image so the container starts instantly
# and doesn't need network access at runtime. HF_TOKEN is only used at build
# time (for a faster/authenticated download) and isn't kept in the final
# image env.
ARG MODEL_NAME=BAAI/bge-m3
ARG HF_TOKEN=${HF_TOKEN}
ENV MODEL_NAME=${MODEL_NAME}
RUN HF_TOKEN=${HF_TOKEN} python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${MODEL_NAME}')"

COPY . .

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
