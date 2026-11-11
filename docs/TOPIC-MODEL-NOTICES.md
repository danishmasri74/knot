# Bundled local topic model

Knot bundles Xenova/multilingual-e5-small at revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, the quantized ONNX conversion of intfloat/multilingual-e5-small (MIT license). The model card is included with the model, and manifest.json pins every asset by SHA-256.

The runtime is @huggingface/transformers 3.8.1 (Apache-2.0) and onnxruntime-web 1.22.0-dev.20250409-89f8206ba4 (MIT). Runtime and model resources are bundled locally. No cloud embeddings or runtime model downloads are used.

E5 uses query: and passage: prefixes, attention-mask-aware mean pooling, and L2 normalization. Inference runs in a worker using single-threaded WASM. Source passages are refined using the pinned tokenizer before embedding.
