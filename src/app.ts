// src/app.ts
import express, { Application } from 'express';
import dotenv from 'dotenv';
import productRoutes from './routes/products';
import cors from 'cors';

dotenv.config();

const app: Application = express();
app.use(cors({
  origin: 'http://localhost:3001',  // 프론트엔드가 3001 포트 사용
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json()); // JSON 형식의 요청 본문을 해석

// Products 라우트 설정
app.use('/api/products', productRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
