export type BuildLogEntry = {
  date: string;
  title: string;
  summary: string;
  linkedinUrl?: string;
  demoUrl?: string;
};

export const homeContent: {
  buildLog: BuildLogEntry[];
  github: {
    url: string;
    label: string;
  };
} = {
  buildLog: [],
  github: {
    url: "https://github.com/erdemcapci/assurenodia",
    label: "View GitHub repository"
  }
};
