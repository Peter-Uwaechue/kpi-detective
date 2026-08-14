CREATE TABLE `leadership_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(140) NOT NULL,
	`name` varchar(180) NOT NULL,
	`title` varchar(220) NOT NULL,
	`organisation` varchar(220) NOT NULL,
	`portraitUrl` text NOT NULL,
	`portraitKey` varchar(520),
	`linkedinUrl` varchar(520),
	`quote` text,
	`biography` text NOT NULL,
	`sectors` text NOT NULL,
	`expertise` text NOT NULL,
	`displayOrder` int NOT NULL DEFAULT 0,
	`isPublished` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leadership_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `leadership_profiles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
