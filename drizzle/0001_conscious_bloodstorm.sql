CREATE TABLE `candidate_referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobSlug` varchar(180) NOT NULL,
	`jobTitle` varchar(260) NOT NULL,
	`referrerName` varchar(180) NOT NULL,
	`referrerEmail` varchar(320) NOT NULL,
	`candidateName` varchar(180) NOT NULL,
	`candidateEmail` varchar(320) NOT NULL,
	`candidateLinkedin` varchar(520),
	`rationale` text NOT NULL,
	`cvFileName` varchar(255) NOT NULL,
	`cvMimeType` varchar(120) NOT NULL,
	`cvStorageKey` varchar(520) NOT NULL,
	`cvUrl` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candidate_referrals_id` PRIMARY KEY(`id`)
);
