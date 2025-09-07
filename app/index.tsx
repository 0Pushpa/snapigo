import { Redirect } from "expo-router";

export default function Index() {
  // When the app launches, immediately go to the Scan tab
  return <Redirect href="/(tabs)/scan" />;
}
