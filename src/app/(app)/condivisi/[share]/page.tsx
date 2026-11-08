import { notFound } from "next/navigation";
import { ShareHome } from "@/app/ui/gallery/share-views";
import { requireUser } from "@/lib/session";
import { getUserShare } from "@/lib/shares";

export default async function UserSharePage({ params, searchParams }: PageProps<"/condivisi/[share]">) {
  const user = await requireUser();
  const { share: id } = await params;
  const share = await getUserShare(id, user);
  if (!share) notFound();
  return (
    <ShareHome
      share={share}
      base={`/condivisi/${share.public_id}`}
      role={user.role}
      userId={user.id}
      access={{ share: share.public_id }}
      searchParams={await searchParams}
    />
  );
}
