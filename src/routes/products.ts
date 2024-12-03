// src/routes/products.ts
import express, { Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';
import { OpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { similarity } from 'ml-distance';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o-mini",
    temperature: 0.7
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

        const [reviewRows] = await pool.query<RowDataPacket[]>(
            'SELECT product_review FROM Product_Review WHERE product_id = ?',
            [productId]
        );

        const reviews = reviewRows.map(row => row.product_review);

        try {
            const systemPrompt = `당신은 친근한 쇼핑 도우미입니다. 다음 가이드라인을 따라주세요:
                - 이모티콘을 적절히 사용해주세요
                - 상품의 주요 장점을 먼저 언급하고, 실제 구매자들의 경험을 인용해주세요
                - 2-3문장으로 간단명료하게 작성해주세요
                - 중요한 부분은 <b></b> 태그로 강조해주세요 (절대 마크다운 ** 사용하지 말 것)
                - 할인율이 있다면 이를 강조해주세요
                - 가격 대비 가치를 구체적으로 언급하며 구매를 권유해주세요`;

            const userPrompt = `다음은 "${productName}" 상품에 대한 정보입니다:
                - 현재 가격: ${currentPrice.toLocaleString()}원
                - 정상 가격: ${regularPrice.toLocaleString()}원
                - 할인율: ${discountRate}%
                
                그리고 다음은 실제 구매자들의 리뷰입니다:
                ${reviews.join("\n")}
                
                이 정보들을 바탕으로 구매를 고민하는 사람들에게 추천 멘트를 작성해주세요.`;

            const recommendation = await openai.invoke(systemPrompt + "\n\n" + userPrompt);

            res.json({
                recommendation,
                productDetails: {
                    name: productName,
                    reviews: reviews
                }
            });

        } catch (apiError) {
            console.error('OpenAI API Error:', apiError);
            res.json(mockRecommendation);
        }
        
    } catch (error) {
        console.error('Error fetching recommendation:', error);
        res.status(500).json({ error: 'Failed to fetch recommendation' });
    }
});

// 리뷰 기반 키워드와 관련된 상품 추천
router.get('/recommend/:keyword', async (req: Request, res: Response) => {
    try {
        const { keyword } = req.params;
        const embeddings = new OpenAIEmbeddings({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: "text-embedding-3-small"
        });
        
        // 1. 모든 상품의 리뷰 데이터 가져오기
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                p.product_id,
                p.product_name,
                pr.product_review,
                pr.star_score,
                rs.is_pros,
                rs.summary_text,
                rc.name as category_name,
                rc.icon_name
            FROM Products p
            INNER JOIN Product_Review pr ON p.product_id = pr.product_id
            INNER JOIN review_summaries rs ON p.product_id = rs.product_id
            INNER JOIN review_categories rc ON rs.category_id = rc.id
            WHERE p.discount_rate > 10
        `);
        console.log('📝 조회된 상품 수:', rows.length);

        // 2. 리뷰 문서 생성 및 임베딩
        const documents = rows.map(row => new Document({
            pageContent: row.product_review,
            metadata: {
                productId: row.product_id,
                productName: row.product_name,
                starScore: row.star_score
            }
        }));

        // 3. 키워드와 리뷰 임베딩 생성
        const keywordEmbedding = await embeddings.embedQuery(keyword);
        const documentEmbeddings = await embeddings.embedDocuments(
            documents.map(doc => doc.pageContent)
        );

        // 4. 유사도 계산 및 가중치 적용
        const productScores = new Map<number, { score: number, count: number, productName: string }>();

        documentEmbeddings.forEach((embedding, index) => {
            const doc = documents[index];
            const similarityScore = similarity.cosine(keywordEmbedding, embedding);
            const weightedScore = similarityScore * doc.metadata.starScore;

            if (!productScores.has(doc.metadata.productId)) {
                productScores.set(doc.metadata.productId, {
                    score: 0,
                    count: 0,
                    productName: doc.metadata.productName
                });
            }

            const product = productScores.get(doc.metadata.productId);
            if (product) {
                product.score += weightedScore;
                product.count += doc.metadata.starScore;
            }
        });

        // 5. 평균 점수 계산 및 정렬
        const similarities = Array.from(productScores.entries())
            .map(([productId, data]) => ({
                productId,
                productName: data.productName,
                averageSimilarity: data.score / data.count,
            }))
            .sort((a, b) => b.averageSimilarity - a.averageSimilarity);

        console.log('유사도 계산 결과 (상위 5개):');
        similarities.slice(0, 5).forEach((item, index) => {
            console.log(`${index + 1}. ${item.productName} (평균 유사도: ${item.averageSimilarity.toFixed(4)})`);
        });

        // 6. 상위 2개 상품의 상세 정보 조회
        const topProductIds = similarities.slice(0, 2).map(item => item.productId);
        
        const [detailedProducts] = await pool.query<RowDataPacket[]>(`
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
            WHERE product_id IN (?);
        `, [topProductIds]);

        console.log('📦 상세 상품 정보:', detailedProducts);
        
        res.json(detailedProducts);

    } catch (error) {
        console.error('Error in recommendation:', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
    }
});

export default router;