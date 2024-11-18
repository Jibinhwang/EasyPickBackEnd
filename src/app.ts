// src/app.ts
import express, { Application } from 'express';
import dotenv from 'dotenv';
import productRoutes from './routes/products';

dotenv.config();

const app: Application = express();
app.use(express.json()); // JSON 형식의 요청 본문을 해석

// Products 라우트 설정
app.use('/api/products', productRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
