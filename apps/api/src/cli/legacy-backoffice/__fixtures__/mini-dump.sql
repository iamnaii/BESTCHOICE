-- MariaDB dump 10.19-11.4.0-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: legacy_fixture
-- ------------------------------------------------------
-- SYNTHETIC FIXTURE — every value below is invented test data (no real customer, contract or payment).
-- Server version	11.4.0-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET TIME_ZONE='+00:00' */;

--
-- Table structure for table `bestchoice_contract`
--

DROP TABLE IF EXISTS `bestchoice_contract`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bestchoice_contract` (
  `contract_id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_code` varchar(50) DEFAULT NULL,
  `ref_order` int(11) DEFAULT NULL,
  `contract_status` char(1) DEFAULT '0',
  `contract_remark` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `canceled_at` datetime DEFAULT NULL,
  PRIMARY KEY (`contract_id`),
  KEY `ref_order` (`ref_order`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bestchoice_contract`
--

LOCK TABLES `bestchoice_contract` WRITE;
/*!40000 ALTER TABLE `bestchoice_contract` DISABLE KEYS */;
INSERT INTO `bestchoice_contract` VALUES
(1,'TEST-C-0001',101,'3','NULL','2026-01-05 10:00:00',NULL),
(2,'TEST-C-0002',102,'4','ลูกค้า \'ทดสอบ\', (ไม่มี)\nบรรทัดสอง','2026-01-06 11:30:00','2026-03-01 08:00:00'),
(3,'TEST-C-0003',103,'2','ข้อความ; มีอัฒภาค),(และวงเล็บ','2026-01-07 12:45:00',NULL);
/*!40000 ALTER TABLE `bestchoice_contract` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bestchoice_expenses`
--

DROP TABLE IF EXISTS `bestchoice_expenses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bestchoice_expenses` (
  `expenses_id` int(11) NOT NULL AUTO_INCREMENT,
  `expenses_name` varchar(255) DEFAULT NULL,
  `expenses_amount` decimal(10,2) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`expenses_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bestchoice_expenses`
--

LOCK TABLES `bestchoice_expenses` WRITE;
/*!40000 ALTER TABLE `bestchoice_expenses` DISABLE KEYS */;
/*!40000 ALTER TABLE `bestchoice_expenses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bestchoice_payment_installment`
--

DROP TABLE IF EXISTS `bestchoice_payment_installment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bestchoice_payment_installment` (
  `payment_id` int(11) NOT NULL AUTO_INCREMENT,
  `ref_contract` int(11) DEFAULT NULL,
  `ref_installmemnt` int(11) DEFAULT NULL,
  `payment_amount` decimal(10,2) DEFAULT NULL,
  `payment_slip` varchar(255) DEFAULT NULL,
  `payment_remark` text DEFAULT NULL,
  `status` char(1) DEFAULT '1',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`payment_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bestchoice_payment_installment`
--

LOCK TABLES `bestchoice_payment_installment` WRITE;
/*!40000 ALTER TABLE `bestchoice_payment_installment` DISABLE KEYS */;
INSERT INTO `bestchoice_payment_installment` VALUES (1,1,11,100.00,'uploads\\slip\\TEST-0001.jpg','แท็บ\tคั่น \"อ้าง\"','1','2026-01-10 09:00:00'),(2,1,12,50.50,NULL,'ยกเลิก\r\nรายการ\0จบ','0','2026-01-11 09:00:00');
INSERT INTO `bestchoice_payment_installment` VALUES (3,2,21,25.25,NULL,'บรรทัดแรก
บรรทัดที่สอง (ขึ้นบรรทัดจริง)','1','2026-01-12 09:00:00');
/*!40000 ALTER TABLE `bestchoice_payment_installment` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

-- Dump completed on 2026-10-29 10:00:00
