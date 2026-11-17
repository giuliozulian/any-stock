-- The same article can mention two watched stocks: it must belong to each of them, so uniqueness moves from the url alone to (stockId, url).
-- DropIndex
DROP INDEX "NewsItem_url_key";

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_stockId_url_key" ON "NewsItem"("stockId", "url");
