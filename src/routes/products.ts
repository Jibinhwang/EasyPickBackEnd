// src/routes/products.ts
import express, { Request, Response } from 'express';
import pool from '../db';
import { RowDataPacket } from 'mysql2/promise';
import OpenAI from 'openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { similarity } from 'ml-distance';
import dotenv from 'dotenv';
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { VectorStore } from "@langchain/core/vectorstores";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const router = express.Router();

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
                product_link as productLink,
                score_review as scoreReview
            FROM Products 
            WHERE discount_rate > 0
            ORDER BY discount_rate DESC
            LIMIT 1
        `);
        
        if (rows.length === 0) {
            res.status(404).json({ message: 'No deals found' });
            return;
        }
        
        const deal = rows[0];
        res.json({
            productID: deal.productID,
            manufacturer: deal.manufacturer,
            title: deal.title,
            currentPrice: deal.currentPrice,
            originalPrice: deal.originalPrice,
            discountRate: deal.discountRate,
            imageUrl: deal.imageUrl,
            productLink: deal.productLink,
            scoreReview: deal.scoreReview
        });
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 상품의 리뷰 조회
router.get('/:productId/reviews', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        
        // 먼저 review_num을 가져오는 쿼리 추가
        const [productInfo] = await pool.query<RowDataPacket[]>(
            'SELECT review_num FROM Products WHERE product_id = ?',
            [productId]
        );
        
        const reviewNum = productInfo[0]?.review_num || 0;
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
        
        res.json({ 
            pros, 
            cons,
            reviewNum
        });
        
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

            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 200
            });

            const recommendation = response.choices[0].message.content;

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
        
        // 1. SQL 쿼리 개선 - 리뷰 데이터를 더 효과적으로 결합
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                p.product_id,
                p.product_name,
                GROUP_CONCAT(DISTINCT pr.product_review SEPARATOR ' ') as combined_reviews,
                AVG(pr.star_score) as avg_star_score,
                GROUP_CONCAT(DISTINCT 
                    CASE WHEN rs.is_pros = 1 
                    THEN rs.summary_text 
                    END SEPARATOR ' ') as pros_summary,
                GROUP_CONCAT(DISTINCT 
                    CASE WHEN rs.is_pros = 0 
                    THEN rs.summary_text 
                    END SEPARATOR ' ') as cons_summary
            FROM Products p
            INNER JOIN Product_Review pr ON p.product_id = pr.product_id
            LEFT JOIN review_summaries rs ON p.product_id = rs.product_id
            WHERE p.discount_rate > 10
            GROUP BY p.product_id
            HAVING AVG(pr.star_score) >= 4  -- 평점 4점 이상인 상품만 추천
        `);

        // 2. 문서 생성 시 더 많은 컨텍스트 포함
        const documents = rows.map(row => new Document({
            pageContent: `
                상품명: ${row.product_name}
                리뷰: ${row.combined_reviews}
                장점: ${row.pros_summary || ''}
                단점: ${row.cons_summary || ''}
            `,
            metadata: {
                productId: row.product_id,
                productName: row.product_name,
                starScore: row.avg_star_score
            }
        }));

        // 3. 임베딩 및 유사도 계산 로직은 유지
        const keywordEmbedding = await embeddings.embedQuery(keyword);
        const documentEmbeddings = await embeddings.embedDocuments(
            documents.map(doc => doc.pageContent)
        );

        // 4. 가중치 계산 개선
        const productScores = new Map<number, { score: number, count: number, productName: string }>();

        documentEmbeddings.forEach((embedding, index) => {
            const doc = documents[index];
            const similarityScore = similarity.cosine(keywordEmbedding, embedding);
            // 별점 가중치를 더 강화
            const weightedScore = similarityScore * Math.pow(doc.metadata.starScore, 2);

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
                product.count += 1;
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
                product_link as productLink,
                score_review as scoreReview
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

// 자연어 쿼리를 처리하는 새로운 엔드포인트
interface ProductWithReviews extends RowDataPacket {
  product_id: number;
  product_name: string;
  product_brand: string;
  current_price: number;
  regular_price: number;
  discount_rate: number;
  img_url: string;
  product_link: string;
  score_review: number;
  review_num: number;
  major_category: string;
  minor_category: string;
  reviews: string;
  avg_star_score: number;
  pros_summary: string;
  cons_summary: string;
}

interface ProductDocument extends Document {
  metadata: {
    productId: number;
    brand: string;
    category: string;
    price: number;
    discountRate: number;
    rating: number;
  };
}

async function createVectorStore(products: ProductWithReviews[]): Promise<VectorStore> {
  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "text-embedding-3-small"
  });

  const documents: ProductDocument[] = products.map(product => {
    const content = `
      상품명: ${product.product_name}
      브랜드: ${product.product_brand}
      카테고리: ${product.major_category} ${product.minor_category}
      가격: ${product.current_price}원 (할인율: ${product.discount_rate}%)
      평점: ${product.avg_star_score}
      장점: ${product.pros_summary || ''}
      단점: ${product.cons_summary || ''}
      리뷰: ${product.reviews || ''}
    `.trim();

    return new Document({
      pageContent: content,
      metadata: {
        productId: product.product_id,
        brand: product.product_brand,
        category: `${product.major_category} ${product.minor_category}`,
        price: product.current_price,
        discountRate: product.discount_rate,
        rating: product.avg_star_score
      }
    });
  });

  return await MemoryVectorStore.fromDocuments(documents, embeddings);
}

router.post('/natural-query', async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      console.log('\n🔍 사용자 질문:', query);

      // 1. 상품 데이터 조회
      const [products] = await pool.query<ProductWithReviews[]>(
        `SELECT 
          p.product_id,
          p.product_name,
          p.product_brand,
          p.current_price,
          p.regular_price,
          p.discount_rate,
          p.img_url,
          p.product_link,
          p.score_review,
          p.review_num,
          p.major_category,
          p.minor_category,
          GROUP_CONCAT(DISTINCT pr.product_review SEPARATOR ' ') as reviews,
          AVG(pr.star_score) as avg_star_score,
          GROUP_CONCAT(DISTINCT 
            CASE WHEN rs.is_pros = 1 
            THEN rs.summary_text 
            END SEPARATOR ' ') as pros_summary,
          GROUP_CONCAT(DISTINCT 
            CASE WHEN rs.is_pros = 0 
            THEN rs.summary_text 
            END SEPARATOR ' ') as cons_summary
         FROM Products p
         LEFT JOIN Product_Review pr ON p.product_id = pr.product_id
         LEFT JOIN review_summaries rs ON p.product_id = rs.product_id
         WHERE p.discount_rate >= 10
         GROUP BY p.product_id
         HAVING AVG(COALESCE(pr.star_score, 0)) >= 4
         LIMIT 100`
      );
      console.log('📦 조회된 상품 수:', products.length);
      
      // 2. Vector Store 생성
      const vectorStore = await createVectorStore(products);
      console.log('🎯 Vector Store 생성 완료');

      // 3. RAG 체인 구성
      const retriever = vectorStore.asRetriever({
        k: 3, // 상위 3개 상품 검색
      });

      const contextPrompt = PromptTemplate.fromTemplate(`
        사용자 질문: {question}

        다음은 관련된 상품들의 정보입니다:
        {context}

        위 정보를 바탕으로 사용자의 질문에 대한 추천 답변을 작성해주세요.
        
        답변 형식:
        - 가격, 할인율, 평점 등 구체적인 수치 정보를 포함해주세요
        - 실제 리뷰나 장점을 인용하여 설득력을 높여주세요
        - 2-3개의 상품을 비교하여 추천해주세요
        - 친근하고 자연스러운 톤으로 작성해주세요
        - 이모티콘 적절히 사용해주세요

        필수 지침:
        1. 강조가 필요할 때는 반드시 <b></b> 태그만 사용할 것
        2. 가격은 "<b>8,900원</b>" 형식으로 표시
        3. 할인율은 "<b>40% 할인</b>" 형식으로 표시
        4. 평점은 "<b>평점 4.5점</b>" 형식으로 표시
        5. 상품명은 "<b>상품명</b>" 형식으로 표시
        6. 인용은 "<quote></quote>" 형식으로 표시
        7. 너의 답변에 **가 있으면 다 지워줘
      `);

      const llm = new ChatOpenAI({
        modelName: "gpt-4o-mini",
        temperature: 0.7,
      });

      const chain = RunnableSequence.from([
        {
          context: async (input: { question: string }) => {
            const docs = await retriever.getRelevantDocuments(input.question);
            return docs.map(doc => doc.pageContent).join('\n\n');
          },
          question: (input: { question: string }) => input.question,
        },
        contextPrompt,
        llm,
        new StringOutputParser(),
      ]);

      // 4. RAG 체인 실행
      console.log('\n⚡ RAG 체인 실행 중...');
      const answer = await chain.invoke({
        question: query,
      });
      console.log('\n💬 생성된 답변:', answer);

      // 5. 최종 추천 상품
      const retrievedDocs = await vectorStore.similaritySearch(query, 3);
      const recommendedProducts = await Promise.all(
        retrievedDocs.map(async (doc) => {
          const product = products.find(p => p.product_id === doc.metadata.productId);
          return {
            productID: product?.product_id,
            manufacturer: product?.product_brand,
            title: product?.product_name,
            currentPrice: product?.current_price,
            originalPrice: product?.regular_price,
            discountRate: product?.discount_rate,
            imageUrl: product?.img_url,
            productLink: product?.product_link,
            scoreReview: product?.score_review,
            reviewNum: product?.review_num,
            similarity: doc.metadata.score
          };
        })
      );
      console.log('\n✨ 최종 추천 상품:', recommendedProducts.map(p => ({
        id: p.productID,
        name: p.title,
        price: p.currentPrice,
        discount: p.discountRate + '%'
      })));

      res.json({
        success: true,
        answer,
        products: recommendedProducts
      });

    } catch (error) {
      console.error('Error in natural query:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// 할인율 높은 상품 10개 조회
  router.get('/top-discounts', async (req: Request, res: Response) => {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT DISTINCT
                p.product_id as productID,
                p.product_brand as manufacturer,
                p.product_name as title,
                p.current_price as currentPrice,
                p.regular_price as originalPrice,
                p.discount_rate as discountRate,
                p.img_url as imageUrl,
                p.product_link as productLink,
                p.score_review as scoreReview
            FROM Products p
            INNER JOIN review_summaries rs ON p.product_id = rs.product_id
            WHERE p.discount_rate > 0
            ORDER BY p.discount_rate DESC
            LIMIT 20
        `);
        
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

router.get('/top-reviewed-discounts', async (req: Request, res: Response) => {
    try {
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT DISTINCT
                p.product_id as productID,
                p.product_brand as manufacturer,
                p.product_name as title,
                p.current_price as currentPrice,
                p.regular_price as originalPrice,
                p.discount_rate as discountRate,
                p.img_url as imageUrl,
                p.product_link as productLink,
                COUNT(pr.product_review) as review_count
            FROM Products p
            INNER JOIN review_summaries rs ON p.product_id = rs.product_id
            INNER JOIN Product_Review pr ON p.product_id = pr.product_id
            WHERE p.discount_rate > 15
            GROUP BY p.product_id
            ORDER BY review_count DESC
            LIMIT 2
        `);
        
        res.json(rows);
    } catch (error) {
        console.error('Error fetching top-reviewed discounts:', error);
        res.status(500).json({ message: (error as Error).message });
    }
});

router.get('/:productId/price-history', async (req: Request, res: Response) => {
    try {
        const { productId } = req.params;
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT price_time, price_at
            FROM Product_Price_Change
            WHERE product_id = ?
            ORDER BY price_time ASC
        `, [productId]);

        res.json(rows);
    } catch (error) {
        console.error('Error fetching price history:', error);
        res.status(500).json({ message: (error as Error).message });
    }
});

// 사용자 찜한 상품 조회
router.get('/:userId/likes', async (req: Request, res: Response) => {
    try {
        const { userId } = req.params;
        console.log('userId:', userId);
        const [rows] = await pool.query<RowDataPacket[]>(`
            SELECT 
                p.product_id as productID,
                p.product_brand as manufacturer,
                p.product_name as title,
                p.current_price as currentPrice,
                p.regular_price as originalPrice,
                p.discount_rate as discountRate,
                p.img_url as imageUrl,
                p.product_link as productLink,
                ul.like_price as likePrice
            FROM User_Likes ul
            INNER JOIN Products p ON ul.product_id = p.product_id
            WHERE ul.user_id = ?
        `, [userId]);

        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 찜하기 추가
router.post('/:userId/likes/:productId', async (req: Request, res: Response) => {
    try {
        const { userId, productId } = req.params;
        const { currentPrice } = req.body;
        
        await pool.query(
            'INSERT INTO User_Likes (user_id, product_id, like_price) VALUES (?, ?, ?)',
            [userId, productId, currentPrice]
        );
        
        res.json({ message: 'Product liked successfully' });
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 찜하기 삭제
router.delete('/:userId/likes/:productId', async (req: Request, res: Response) => {
    try {
        const { userId, productId } = req.params;
        
        await pool.query(
            'DELETE FROM User_Likes WHERE user_id = ? AND product_id = ?',
            [userId, productId]
        );
        
        res.json({ message: 'Product unliked successfully' });
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

// 특정 카테고리 조회
router.get('/search', async (req: Request, res: Response) => {
    try {
        const { category, brand, minPrice, maxPrice, orderBy } = req.query;
        let query = `SELECT * FROM Products WHERE 1=1`;
        const params: any[] = [];
        if (category) {
            query += ' AND major_category = ?';
            params.push(category);
        }
        if (brand) {
            query += ' AND product_brand = ?';
            params.push(brand);
        }
        if (minPrice) {
            query += ' AND regular_price >= ?';
            params.push(Number(minPrice));
        }
        if (maxPrice) {
            query += ' AND regular_price <= ?';
            params.push(Number(maxPrice));
        }
        if (orderBy == 'review') {
            query += ' ORDER BY review_num';
        } else if (orderBy == 'score') {
            query += ' ORDER BY score_review DESC';
        } else if (orderBy == 'price') {
            query += ' ORDER BY current_price ASC';
        }
        const [products] = await pool.query<RowDataPacket[]>(query, params);
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: (error as Error).message });
    }
});

export default router;
