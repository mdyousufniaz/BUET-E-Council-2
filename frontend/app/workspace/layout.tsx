import Header from "../../components/Header";
import WorkspaceLayoutWrapper from "../../components/WorkspaceLayoutWrapper";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <WorkspaceLayoutWrapper>
        {children}
      </WorkspaceLayoutWrapper>
    </div>
  );
}
