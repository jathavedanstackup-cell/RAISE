-- CreateTable
CREATE TABLE "visit_allergy_acknowledgments" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staff_user_id" TEXT NOT NULL,

    CONSTRAINT "visit_allergy_acknowledgments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_allergy_acknowledgments_visit_id_key" ON "visit_allergy_acknowledgments"("visit_id");

-- CreateIndex
CREATE INDEX "visit_allergy_acknowledgments_restaurant_id_idx" ON "visit_allergy_acknowledgments"("restaurant_id");

-- AddForeignKey
ALTER TABLE "visit_allergy_acknowledgments" ADD CONSTRAINT "visit_allergy_acknowledgments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
