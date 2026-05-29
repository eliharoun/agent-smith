import { Link } from "react-router-dom";
import { CatalogList } from "@/panels/CatalogList";
import { Button } from "@/ui/Button";
import { Chrome } from "@/ui/Chrome";
import { ScreenShell } from "@/ui/ScreenShell";

export function Catalogs() {
  return (
    <ScreenShell
      chrome={
        <Chrome
          title="Catalogs"
          subtitle="// where agents and skills are sourced from"
          actions={
            <Link to="/catalogs/register">
              <Button>+ Register</Button>
            </Link>
          }
        />
      }
    >
      <CatalogList />
    </ScreenShell>
  );
}
