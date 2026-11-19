import { currentDevice, getAttendanceSettings } from "@/lib/shop-device";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const device = await currentDevice();
  const cutoff = device ? (await getAttendanceSettings()).dayCutoff : "";
  return <LoginForm device={device && { name: device.name, shop: device.location.name, cutoff }} />;
}
