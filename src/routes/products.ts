// src/routes/products.ts
import express, { Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';

const router = express.Router();

// 모든 제품 조회
router.get('/', async (req: Request, res: Response) => {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Products');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 특정 ID의 제품 조회
router.get('/:id', async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
        res.status(400).json({ message: 'Invalid product ID' });
        return;  // 요청 처리를 중단하고 에러 응답을 보냅니다.
    }

    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Products WHERE id = ?', [id]);
        if (rows.length === 0) {
            res.status(404).json({ message: 'Product not found' });
            return;  // 요청 처리를 중단하고 에러 응답을 보냅니다.
        }
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

export default router;
