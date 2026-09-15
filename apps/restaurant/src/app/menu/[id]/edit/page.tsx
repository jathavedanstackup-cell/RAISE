import { notFound, redirect } from "next/navigation";
import type { MenuItemDto } from "@raise/shared-types";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireStaffSession } from "@/lib/require-staff-session";
import { MenuItemForm } from "@/components/menu-item-form";
import { updateMenuItemAction } from "../../actions";

export default async function EditMenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireStaffSession();
  if (session.role !== "owner") redirect("/menu");

  let item: MenuItemDto;
  try {
    item = await apiFetch<MenuItemDto>(`/restaurants/${session.restaurantId}/menu-items/${id}`, session.token, {
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-lg flex-1 px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-foreground">Edit {item.name}</h1>
      <div className="mt-6">
        <MenuItemForm action={updateMenuItemAction.bind(null, id)} defaultValues={item} submitLabel="Save changes" />
      </div>
    </div>
  );
}
