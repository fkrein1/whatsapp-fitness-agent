import { Composition } from "remotion";
import { FitnessAgentDemo } from "./Video";

export const Root = () => (
  <Composition
    id="FitnessAgentDemo"
    component={FitnessAgentDemo}
    durationInFrames={1140}
    fps={30}
    width={1080}
    height={1350}
  />
);
