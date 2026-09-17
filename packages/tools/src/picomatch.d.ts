declare module 'picomatch' {
  type PicomatchOptions = { dot?: boolean };
  type PicomatchMatcher = (input: string) => boolean;

  export default function picomatch(
    patterns: string | string[],
    options?: PicomatchOptions,
  ): PicomatchMatcher;
}
