import { currentDevice, getAttendanceSettings } from "@/lib/shop-device";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ bye?: string }> }) {
  const device = await currentDevice();
  const cutoff = device ? (await getAttendanceSettings()).dayCutoff : "";
  // After End my day: the clock-out time, shown once. Only a time is accepted.
  const { bye } = await searchParams;
  return <LoginForm device={device && { name: device.name, shop: device.location.name, cutoff }} bye={bye && /^\d\d:\d\d$/.test(bye) ? bye : null} />;
}
