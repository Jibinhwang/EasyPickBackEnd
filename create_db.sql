-- Active: 1732764838123@@127.0.0.1@3306
-- 데이터베이스 삭제
DROP DATABASE IF EXISTS ProductDB;

CREATE DATABASE ProductDB;
USE ProductDB;

-- Products 테이블
CREATE TABLE Products (
    product_id INT PRIMARY KEY,
    product_brand VARCHAR(255),
    product_name VARCHAR(255),
    product_link VARCHAR(1000),
    img_url VARCHAR(1000),
    current_price INT,
    regular_price INT,
    discount_rate FLOAT,
    score_review FLOAT,
    review_num INT,
    major_category VARCHAR(100),
    minor_category VARCHAR(100)
);

-- Product_Review 테이블
CREATE TABLE Product_Review (
    product_id INT,
    star_score INT,
    product_review TEXT,    
    FOREIGN KEY (product_id) REFERENCES Products(product_id)
);

-- Product_Price_Change 테이블
CREATE TABLE Product_Price_Change (
    product_id INT,
    price_time TIMESTAMP,
    price_at INT,
    FOREIGN KEY (product_id) REFERENCES Products(product_id)
);

-- User_Info 테이블
CREATE TABLE User_Info (
    user_id INT PRIMARY KEY,
    password VARCHAR(10) NOT NULL
);

-- User_Likes 테이블
CREATE TABLE User_Likes (
    user_id INT,
    product_id INT,
    like_price INT,
    FOREIGN KEY (user_id) REFERENCES User_Info(user_id),
    FOREIGN KEY (product_id) REFERENCES Products(product_id),
    PRIMARY KEY (user_id, product_id)  -- 동일 사용자가 동일 제품을 중복 저장하지 않도록
);

-- 리뷰 카테고리 마스터 테이블
CREATE TABLE Review_Categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,          
    icon_name VARCHAR(50) NOT NULL      
);

-- 리뷰 요약 테이블
CREATE TABLE Review_Summaries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    category_id INT NOT NULL,
    is_pros BOOLEAN NOT NULL,           
    summary_text VARCHAR(200) NOT NULL,
    FOREIGN KEY (product_id) REFERENCES Products(product_id),
    FOREIGN KEY (category_id) REFERENCES Review_Categories(id)
);

-- 리뷰 상세 내용 테이블
CREATE TABLE Review_Details (
    id INT PRIMARY KEY AUTO_INCREMENT,
    summary_id INT NOT NULL,
    detail_text VARCHAR(200) NOT NULL,
    FOREIGN KEY (summary_id) REFERENCES Review_Summaries(id)
);

-- 기본 카테고리 데이터 입력
INSERT INTO Review_Categories (name, icon_name) VALUES 
('배송', 'FiTruck'),           -- 배송 관련
('맛', 'FiCoffee'),           -- 맛 관련
('포장', 'FiPackage'),        -- 포장 관련
('가격', 'FiDollarSign'),         -- 가격 관련
('편리성', 'FiClock'),        -- 편리성/사용성 관련
('기타', 'FiMoreHorizontal'); -- 기타 의견