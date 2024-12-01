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

// 할인율이 가장 높은 상품 조회
router.get('/todays-deal', async (req: Request, res: Response) => {
    console.log('todays-deal');
    try {
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                product_id as productID,
                product_brand as manufacturer,
                product_name as title,
                current_price as currentPrice,
                regular_price as originalPrice,
                discount_rate as discountRate,
                img_url as imageUrl,
                product_link as productLink
            FROM Products 
            WHERE discount_rate > 0
            ORDER BY discount_rate DESC
            LIMIT 1
        `);
        
        if (rows.length === 0) {
            res.status(404).json({ message: 'No deals found' });
            return;
        }
        
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 상품의 리뷰 조회
router.get('/:productId/reviews', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        
        console.log('Product ID:', productId);
        const query = `
            SELECT 
                rc.id as category_id,
                rc.name as category_name,
                rc.icon_name,
                rs.is_pros,
                rs.summary_text,
                GROUP_CONCAT(rd.detail_text) as details
            FROM review_summaries rs
            JOIN review_categories rc ON rs.category_id = rc.id
            LEFT JOIN review_details rd ON rs.id = rd.summary_id
            WHERE rs.product_id = ?
            GROUP BY rc.id, rs.is_pros, rs.summary_text
        `;
        
        const [rows] = await pool.query<RowDataPacket[]>(query, [productId]);
        
        // 리뷰 데이터를 장단점으로 분류
        const pros: any[] = [];
        const cons: any[] = [];
        
        rows.forEach((review: any) => {
            const reviewData = {
                category_id: review.category_id,
                category_name: review.category_name,
                icon_name: review.icon_name,
                summary: review.summary_text,
                details: review.details ? review.details.split(',') : []
            };
            
            if (review.is_pros) {
                pros.push(reviewData);
            } else {
                cons.push(reviewData);
            }
        });
        
        res.json({ pros, cons });
        
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
});

export default router;
