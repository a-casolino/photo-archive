import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Pulsante di shadcn/ui (stile "new-york"), con il rosso dell'app come colore primario.
// Tutti a pillola (rounded-full); sul telefono alti almeno 44 px, così non si
// tocca per sbaglio quello accanto. `danger` è il contorno rosso per le azioni
// che tolgono qualcosa (cestino, elimina, revoca), `destructive` il rosso pieno.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-[0.9375rem] leading-none font-medium no-underline transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-ring/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90",
        danger: "border border-destructive/50 bg-card text-destructive shadow-xs hover:bg-destructive/10",
        outline: "border border-input bg-card text-foreground shadow-xs hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "bg-transparent text-foreground hover:bg-accent",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 max-sm:min-h-11",
        sm: "h-8 gap-1.5 px-3.5 text-sm has-[>svg]:px-3 max-sm:min-h-11 max-sm:px-4",
        lg: "h-10 px-6 has-[>svg]:px-4 max-sm:min-h-11",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
