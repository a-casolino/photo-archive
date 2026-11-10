import { SharedPhoto } from "@/app/ui/gallery/share-views";
import { getLinkShare } from "@/lib/shares";
import { LinkMissing } from "../../missing";

export default async function LinkSharePhotoPage({ params, searchParams }: PageProps<"/l/[token]/foto/[id]">) {
  const { token, id } = await params;
  const share = await getLinkShare(token);
  if (!share) return <LinkMissing token={token} />;
  return (
    <SharedPhoto
      share={share}
      base={`/l/${token}`}
      role={null}
      userId={null}
      access={{ token }}
      searchParams={await searchParams}
      photoPid={id}
    />
  );
}
