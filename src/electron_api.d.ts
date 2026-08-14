export {};

declare global {
  interface Window {
    tutorIde: {
      openProject(): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
      } | null>;
      readProjectFile(relativePath: string): Promise<{
        path: string;
        content: string;
      }>;
    };
  }
}
