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

    try {
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Products WHERE id = ?', [id]);
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

export default router;
