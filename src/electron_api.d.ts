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
      searchProject(query: string): Promise<Array<{
        path: string;
        line: number;
        column: number;
        preview: string;
      }>>;
    };
  }
}
