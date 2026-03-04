import { MilvusClient } from "@zilliz/milvus2-sdk-node";

// Configure Milvus client. In Milvus, the address is normally host:port (e.g. "localhost:19530").
const mlvsClient = new MilvusClient({
    address: process.env.MILVUS_ADDRESS || "localhost:19530",
  });
  
  export default mlvsClient;