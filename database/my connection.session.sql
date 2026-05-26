show databases;
use DataSpark;
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE applications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ref_number VARCHAR(20),
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    dob DATE,
    gender VARCHAR(10),
    address TEXT,
    qualification VARCHAR(100),
    specialization VARCHAR(100),
    year_passing VARCHAR(10),
    current_status VARCHAR(50),
    course VARCHAR(150),
    batch VARCHAR(100),
    mode VARCHAR(20),
    source VARCHAR(50),
    message TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100),
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    interested_course VARCHAR(100),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    course_name VARCHAR(200) NOT NULL DEFAULT 'default',
    module_index INT NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_progress (username, course_name, module_index)
);

CREATE TABLE IF NOT EXISTS completion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    course_name VARCHAR(200) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    completed_at DATETIME,
    UNIQUE KEY unique_user_course (username, course_name)
);
