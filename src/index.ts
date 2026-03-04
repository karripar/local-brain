import app from './app';

const PORT = process.env.PORT || 3006;

app.listen(PORT, () => {
  console.log(`Milvus vector-store API listening on port ${PORT}`);
});
