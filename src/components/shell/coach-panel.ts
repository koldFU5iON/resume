/**
 * Coach panel placement: a full-screen layer on phones, a bounded overlay on
 * tablets and small laptops, and docked beside the content only from xl, where
 * the remaining document area stays usable. Shared by ChatPanel and its error fallback.
 */
export const COACH_PANEL_CLASSES =
  "fixed inset-0 z-50 flex h-svh w-full min-w-0 flex-col overflow-hidden bg-background " +
  "md:left-auto md:z-40 md:w-[min(26rem,100vw)] md:border-l md:shadow-xl " +
  "xl:static xl:z-auto xl:h-full xl:w-[24rem] xl:shrink-0 xl:shadow-none 2xl:w-[30rem] print:hidden"
