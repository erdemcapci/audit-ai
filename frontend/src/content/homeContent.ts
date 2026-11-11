export type BuildLogEntry = {
  date: string;
  title: string;
  summary: string;
  linkedinUrl?: string;
  demoUrl?: string;
};

export type BuildVideo = {
  youtubeId: string;
  title: string;
};

export const homeContent: {
  buildLog: BuildLogEntry[];
  videos: BuildVideo[];
  youtubeChannelUrl: string;
  github: {
    url: string;
    label: string;
  };
} = {
  buildLog: [],
  youtubeChannelUrl: "https://www.youtube.com/@assurenodia",
  videos: [
    { youtubeId: "IVZHYDQpkTc", title: "AI-Assisted Audit Planning in One Connected Map (Open Source)" },
    { youtubeId: "FtiMT5LLuCI", title: "Is Your Audit Plan Really Ready? AI Planning Review" }
  ],
  github: {
    url: "https://github.com/erdemcapci/audit-ai/",
    label: "View GitHub repository"
  }
};
