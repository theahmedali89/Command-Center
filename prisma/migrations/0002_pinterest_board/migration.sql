-- Add default Pinterest board to SocialAccount
ALTER TABLE "SocialAccount" ADD COLUMN "boardId" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "boardName" TEXT;
