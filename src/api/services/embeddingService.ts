import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

export const aiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const embedTexts = async (texts: string[]) => {
  if (!texts.length) return [];

  const resp = await aiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });

  return resp.data.map((d) => d.embedding as number[]);
}

export const embedQuery = async (q: string) => {
  const resp = await aiClient.embeddings.create({
    model: 'text-embedding-3-small',
    input: q,
  });
  return (resp.data[0]?.embedding as number[]) ?? [];
}
