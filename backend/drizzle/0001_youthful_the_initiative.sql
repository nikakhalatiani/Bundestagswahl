CREATE TABLE "voting_codes" (
	"code" varchar(64) PRIMARY KEY NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL
);
