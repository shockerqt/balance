import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import {
  RiCameraLine,
  RiMicLine,
  RiSearchLine,
  RiCalendarLine,
  RiAddLine,
  RiFireLine,
  RiShieldLine,
  RiBarChartGroupedLine,
  RiUser3Line,
  RiSunLine,
  RiAppleLine,
} from "@remixicon/react"

export function App() {
  const [activeTab, setActiveTab] = useState("diary")
  const [searchQuery, setSearchQuery] = useState("")

  return (
    <div className="min-h-screen bg-black text-white p-3 sm:p-6 flex flex-col items-center selection:bg-primary selection:text-primary-foreground font-sans">
      <div className="w-full max-w-md space-y-4 pb-20">
        
        {/* Cal AI Style Top Bar */}
        <header className="flex justify-between items-center px-1">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9 border border-zinc-800">
              <AvatarFallback className="bg-zinc-900 text-xs font-bold text-white">FJ</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-[11px] text-zinc-400 font-medium leading-none">Hola, Francisco</p>
              <h1 className="text-sm font-bold text-white leading-tight mt-0.5">Cal AI Tracker</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-zinc-900/90 text-amber-400 border-zinc-800 text-[11px] font-semibold gap-1 px-2 py-0.5">
              <RiFireLine className="size-3.5 fill-amber-400" />
              5 Días
            </Badge>
          </div>
        </header>

        {/* Date Selector Strip */}
        <div className="flex justify-between items-center bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs font-semibold">
          <button className="text-zinc-400 hover:text-white px-1">‹</button>
          <span className="flex items-center gap-1.5 text-zinc-200">
            <RiCalendarLine className="size-3.5 text-zinc-400" />
            Hoy, Jueves 30 de Julio
          </span>
          <button className="text-zinc-400 hover:text-white px-1">›</button>
        </div>

        {/* Cal AI Calorie & Macro Dashboard Gauge Card */}
        <Card className="bg-zinc-900/80 border-zinc-800 text-white shadow-xl overflow-hidden">
          <CardContent className="p-4 space-y-4">
            
            {/* Main Ring/Gauge Display */}
            <div className="flex justify-between items-center pt-1">
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Calorías Restantes</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold font-mono tracking-tight text-white">360</span>
                  <span className="text-xs text-zinc-400 font-mono font-medium">/ 2,200 kcal</span>
                </div>
              </div>

              {/* Circular Gauge Ring */}
              <div className="relative size-16 flex items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    className="text-zinc-800"
                    strokeWidth="3.5"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                  <path
                    className="text-primary"
                    strokeDasharray="83.6, 100"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  />
                </svg>
                <span className="absolute text-[11px] font-bold font-mono text-zinc-200">83.6%</span>
              </div>
            </div>

            <Separator className="bg-zinc-800/80" />

            {/* 3 Macro Progress Bars */}
            <div className="grid grid-cols-3 gap-2.5 pt-0.5">
              
              {/* Protein Bar */}
              <div className="space-y-1.5 bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/60">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-400 font-bold">PROTEÍNA</span>
                  <span className="font-mono font-semibold text-white">128g</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: "85%" }} />
                </div>
                <p className="text-[9px] text-zinc-500 font-mono text-right">Meta: 150g</p>
              </div>

              {/* Carbs Bar */}
              <div className="space-y-1.5 bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/60">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-400 font-bold">CARBS</span>
                  <span className="font-mono font-semibold text-white">190g</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: "86%" }} />
                </div>
                <p className="text-[9px] text-zinc-500 font-mono text-right">Meta: 220g</p>
              </div>

              {/* Fat Bar */}
              <div className="space-y-1.5 bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-800/60">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-zinc-400 font-bold">GRASAS</span>
                  <span className="font-mono font-semibold text-white">52g</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: "80%" }} />
                </div>
                <p className="text-[9px] text-zinc-500 font-mono text-right">Meta: 65g</p>
              </div>

            </div>

          </CardContent>
        </Card>

        {/* Cal AI Prominent AI Scan Button */}
        <div className="flex gap-2">
          <Button className="flex-1 h-12 bg-white text-black hover:bg-zinc-200 font-bold rounded-xl text-xs gap-2 shadow-lg transition-transform active:scale-[0.98]">
            <RiCameraLine className="size-4 text-black" />
            Escanear Comida con IA
          </Button>

          <Button variant="outline" className="size-12 p-0 bg-zinc-900 border-zinc-800 hover:bg-zinc-800 rounded-xl">
            <RiMicLine className="size-4 text-zinc-300" />
          </Button>

          <Button variant="outline" className="size-12 p-0 bg-zinc-900 border-zinc-800 hover:bg-zinc-800 rounded-xl">
            <RiSearchLine className="size-4 text-zinc-300" />
          </Button>
        </div>

        {/* Quick Food Search Input */}
        <div className="relative">
          <RiSearchLine className="absolute left-3 top-2.5 size-4 text-zinc-500" />
          <Input
            placeholder="Buscar alimento o marca chilena..."
            className="pl-9 bg-zinc-900/60 border-zinc-800 text-xs h-9 rounded-xl placeholder:text-zinc-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Meal Logs Section */}
        <div className="space-y-2.5 pt-1">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Comidas Registradas</h2>
            <button className="text-[11px] text-primary font-semibold hover:underline flex items-center gap-0.5">
              <RiAddLine className="size-3.5" /> Añadir
            </button>
          </div>

          {/* Meal 1: Almuerzo */}
          <Card className="bg-zinc-900/70 border-zinc-800/80 text-white rounded-xl overflow-hidden">
            <CardContent className="p-3 space-y-2.5">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <RiSunLine className="size-3.5 text-amber-400" />
                  Almuerzo (13:30)
                </span>
                <span className="font-mono text-white font-bold">740 kcal</span>
              </div>

              <Separator className="bg-zinc-800/60" />

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-zinc-200">Pechuga de Pollo Ariztía</p>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">200g (1 porción) • P: 62g | C: 0g | G: 7.2g</p>
                  </div>
                  <span className="font-mono text-zinc-300 font-semibold">330 kcal</span>
                </div>

                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-zinc-200">Arroz Integral Cocido</p>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">250g (1.5 taza) • P: 6g | C: 58g | Fibra: 4.5g</p>
                  </div>
                  <span className="font-mono text-zinc-300 font-semibold">275 kcal</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Meal 2: Snack con Sellos Chilenos */}
          <Card className="bg-zinc-900/70 border-zinc-800/80 text-white rounded-xl overflow-hidden">
            <CardContent className="p-3 space-y-2.5">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-zinc-200">
                  <RiAppleLine className="size-3.5 text-emerald-400" />
                  Snack (17:45)
                </span>
                <span className="font-mono text-white font-bold">310 kcal</span>
              </div>

              <Separator className="bg-zinc-800/60" />

              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-medium text-zinc-200">Yogurt Protein Soprole (Chile)</p>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">150g (1 envase) • P: 15g | C: 8g | Sodio: 65mg</p>
                    <div className="flex gap-1 mt-1.5">
                      <span className="inline-flex items-center gap-0.5 bg-black text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded border border-white uppercase tracking-tight">
                        <RiShieldLine className="size-2.5" /> ALTO EN AZÚCARES
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-zinc-300 font-semibold">110 kcal</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cal AI Style Bottom Fixed Nav Dock */}
        <nav className="fixed bottom-3 left-1/2 -translate-x-1/2 w-11/12 max-w-sm bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-2xl p-1.5 flex justify-around items-center shadow-2xl z-50">
          <button
            onClick={() => setActiveTab("diary")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors ${
              activeTab === "diary" ? "text-white bg-zinc-800" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <RiCalendarLine className="size-4" />
            <span>Diario</span>
          </button>

          <button
            onClick={() => setActiveTab("scan")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors ${
              activeTab === "scan" ? "text-white bg-zinc-800" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <RiCameraLine className="size-4" />
            <span>Escáner</span>
          </button>

          <button
            onClick={() => setActiveTab("stats")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors ${
              activeTab === "stats" ? "text-white bg-zinc-800" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <RiBarChartGroupedLine className="size-4" />
            <span>Stats</span>
          </button>

          <button
            onClick={() => setActiveTab("profile")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors ${
              activeTab === "profile" ? "text-white bg-zinc-800" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <RiUser3Line className="size-4" />
            <span>Perfil</span>
          </button>
        </nav>

      </div>
    </div>
  )
}

export default App
