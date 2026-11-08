import { SharedPhoto } from "@/app/ui/gallery/share-views";
import { getLinkShare } from "@/lib/shares";
import { LinkUnavailable } from "../../unavailable";

export default async function LinkSharePhotoPage({ params, searchParams }: PageProps<"/l/[token]/foto/[id]">) {
  const { token, id } = await params;
  const share = await getLinkShare(token);
  if (!share) return <LinkUnavailable />;
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
