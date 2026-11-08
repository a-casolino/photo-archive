import { notFound } from "next/navigation";
import { SharedPhoto } from "@/app/ui/gallery/share-views";
import { requireUser } from "@/lib/session";
import { getUserShare } from "@/lib/shares";

export default async function UserSharePhotoPage({ params, searchParams }: PageProps<"/condivisi/[share]/foto/[id]">) {
  const user = await requireUser();
  const { share: shareId, id } = await params;
  const share = await getUserShare(shareId, user);
  if (!share) notFound();
  return (
    <SharedPhoto
      share={share}
      base={`/condivisi/${share.public_id}`}
      role={user.role}
      userId={user.id}
      access={{ share: share.public_id }}
      searchParams={await searchParams}
      photoPid={id}
    />
  );
}
