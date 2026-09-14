import { redirect } from "next/navigation";
import { requireStaffSession } from "@/lib/require-staff-session";
import { MenuItemForm } from "@/components/menu-item-form";
import { createMenuItemAction } from "../actions";

export default async function NewMenuItemPage() {
  const session = await requireStaffSession();
  if (session.role !== "owner") redirect("/menu");

  return (
    <div className="mx-auto w-full max-w-lg flex-1 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Add a dish</h1>
      <div className="mt-6">
        <MenuItemForm action={createMenuItemAction} submitLabel="Add dish" />
      </div>
    </div>
  );
}
