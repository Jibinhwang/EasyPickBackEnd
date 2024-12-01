// src/routes/products.ts
import express, { Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// 모의 데이터
const mockRecommendation = {
    recommendation: `<b>맛있는 간편식</b>이 <b>40% 할인</b> 중이에요! 😋 구매자들도 <quote>맛있고 간편하게 먹을 수 있어요</quote>라고 극찬했답니다. 정가 10,000원에서 6,000원으로 할인된 지금이 구매하기 딱 좋은 기회예요! ✨`,
    productDetails: {
        name: "테스트 상품",
        reviews: [
            "맛있어요",
            "배송이 빨라요",
            "가성비가 좋아요"
        ]
    }
};

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

// 상품의 리뷰 조회 및 추천 메시지 생성
router.get('/:productId/recommendation', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;

        const [productRows] = await pool.query<RowDataPacket[]>(
            `SELECT 
                product_name,
                current_price,
                regular_price,
                discount_rate
            FROM Products 
            WHERE product_id = ?`,
            [productId]
        );

        const productName = productRows[0].product_name;
        const currentPrice = productRows[0].current_price;
        const regularPrice = productRows[0].regular_price;
        const discountRate = productRows[0].discount_rate;

        // 리뷰 가져오기
        const [reviewRows] = await pool.query<RowDataPacket[]>(
            'SELECT product_review FROM Product_Review WHERE product_id = ?',
            [productId]
        );

        const reviews = reviewRows.map(row => row.product_review);

        // OpenAI API 호출
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `당신은 친근한 쇼핑 도우미입니다. 다음 가이드라인을 따라주세요:
                        - 이모티콘을 적절히 사용해주세요
                        - 상품의 주요 장점을 먼저 언급하고, 실제 구매자들의 경험을 인용해주세요
                        - 2-3문장으로 간단명료하게 작성해주세요
                        - 중요한 부분은 <b></b> 태그로 강조해주세요 (절대 마크다운 ** 사용하지 말 것)
                        - 할인율이 있다면 이를 강조해주세요
                        - 가격 대비 가치를 구체적으로 언급하며 구매를 권유해주세요`
                    },
                    {
                        role: "user",
                        content: `다음은 "${productName}" 상품에 대한 정보입니다:
                        - 현재 가격: ${currentPrice.toLocaleString()}원
                        - 정상 가격: ${regularPrice.toLocaleString()}원
                        - 할인율: ${discountRate}%
                        
                        그리고 다음은 실제 구매자들의 리뷰입니다:
                        ${reviews.join("\n")}
                        
                        이 정보들을 바탕으로 구매를 고민하는 사람들에게 추천 멘트를 작성해주세요. 특히 가격적인 메리트가 있다면 이를 강조해주세요. 중요한 부분은 <b></b> 태그로 강조해주세요 (절대 마크다운 ** 사용하지 말 것)`
                    }
                ],
                temperature: 0.7,
                max_tokens: 250
            });

            const recommendation = completion.choices[0].message.content;

            res.json({
                recommendation,
                productDetails: {
                    name: productName,
                    reviews: reviews
                }
            });

        } catch (apiError) {
            console.error('OpenAI API Error:', apiError);
            res.json(mockRecommendation); // API 호출 실패시에도 모의 데이터 반환
        }
        
    } catch (error) {
        console.error('Error fetching recommendation:', error);
        res.status(500).json({ error: 'Failed to fetch recommendation' });
    }
});

export default router;