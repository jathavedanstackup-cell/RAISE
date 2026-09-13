-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('draft', 'confirmed', 'kitchen_started', 'table_set', 'guest_arrived', 'food_out', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('free', 'held', 'seated');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('customer', 'system');

-- CreateTable
CREATE TABLE "restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "prep_time_minutes" INTEGER NOT NULL,
    "allergens" TEXT[],
    "modifiable_options" TEXT[],
    "available" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seats_min" INTEGER NOT NULL,
    "seats_max" INTEGER NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'free',
    "features" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "party_size" INTEGER NOT NULL,
    "has_child" BOOLEAN NOT NULL DEFAULT false,
    "special_needs" TEXT[],
    "arrival_eta" TIMESTAMP(3) NOT NULL,
    "arrival_confirmed_at" TIMESTAMP(3),
    "table_id" TEXT,
    "table_assigned_at" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_status_events" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "status" "VisitStatus" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_items" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "modifications" TEXT[],
    "allergy_flags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "transcript" TEXT NOT NULL,
    "structured_delta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_idx" ON "menu_items"("restaurant_id");

-- CreateIndex
CREATE INDEX "tables_restaurant_id_idx" ON "tables"("restaurant_id");

-- CreateIndex
CREATE INDEX "visits_restaurant_id_idx" ON "visits"("restaurant_id");

-- CreateIndex
CREATE INDEX "visits_restaurant_id_status_idx" ON "visits"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "visits_table_id_idx" ON "visits"("table_id");

-- CreateIndex
CREATE INDEX "visit_status_events_restaurant_id_idx" ON "visit_status_events"("restaurant_id");

-- CreateIndex
CREATE INDEX "visit_status_events_visit_id_idx" ON "visit_status_events"("visit_id");

-- CreateIndex
CREATE INDEX "visit_items_restaurant_id_idx" ON "visit_items"("restaurant_id");

-- CreateIndex
CREATE INDEX "visit_items_visit_id_idx" ON "visit_items"("visit_id");

-- CreateIndex
CREATE INDEX "visit_items_menu_item_id_idx" ON "visit_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "conversation_turns_restaurant_id_idx" ON "conversation_turns"("restaurant_id");

-- CreateIndex
CREATE INDEX "conversation_turns_visit_id_idx" ON "conversation_turns"("visit_id");

-- CreateIndex
CREATE INDEX "notification_logs_restaurant_id_idx" ON "notification_logs"("restaurant_id");

-- CreateIndex
CREATE INDEX "notification_logs_visit_id_idx" ON "notification_logs"("visit_id");

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_status_events" ADD CONSTRAINT "visit_status_events_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_items" ADD CONSTRAINT "visit_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
