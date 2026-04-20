import {Ollama} from 'ollama';

const embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text'
export const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'http://localhost:11434',
});

export const embedTexts = async (texts: string) => {
  if (!texts) return [];

    const resp = await ollama.embeddings(
      {
        "model": embeddingModel,
        "prompt": texts,
      }
    );


  return (resp?.embedding as number[]) ?? [];
};

export const embedQuery = async (q: string) => {
  if (!q) return [];

    const resp = await ollama.embeddings(
      {
        "model": embeddingModel,
        "prompt": q,
      }
    );

  return (resp?.embedding as number[]) ?? [];
};
