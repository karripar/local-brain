import OpenAI from 'openai';

export const aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

export const embedTexts = async (texts: string[]) => {
  if (!texts.length) return [];

  const resp = await aiClient.embeddings.create({
    model: embeddingModel,
    input: texts,
  });

  return resp.data.map((d) => d.embedding as number[]);
}

export const embedQuery = async (q: string) => {
  const resp = await aiClient.embeddings.create({
    model: embeddingModel,
    input: q,
  });
  return (resp.data[0]?.embedding as number[]) ?? [];
}
