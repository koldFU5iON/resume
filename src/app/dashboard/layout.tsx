import { AppSidebar } from '@/components/app-sidebar';
import { AppShell } from '@/components/shell/app-shell';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppShell>{children}</AppShell>
      </SidebarInset>
    </SidebarProvider>
  );
}
