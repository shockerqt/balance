import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  RiQrCodeLine,
  RiSearchLine,
  RiCalendarLine,
  RiAddLine,
  RiShieldLine,
  RiFireLine,
} from "@remixicon/react"

export function App() {
  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-8">
        {/* Header */}
        <header className="border-b pb-4 text-center sm:text-left flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <Badge variant="outline" className="mb-2">
              Shadcn Preset b6YqzcHxSM
            </Badge>
            <h1 className="text-2xl font-bold tracking-tight">Balance — UI Component Specimen</h1>
            <p className="text-sm text-muted-foreground">
              Catálogo oficial de componentes y tokens de diseño construidos con Shadcn, Base UI y Tailwind v4.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">FJ</AvatarFallback>
            </Avatar>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-semibold">Francisco</p>
              <p className="text-xs text-muted-foreground">fmju96@gmail.com</p>
            </div>
          </div>
        </header>

        {/* Tab Navigation */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-4 max-w-md mx-auto sm:mx-0">
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="buttons">Botones</TabsTrigger>
            <TabsTrigger value="cards">Tarjetas</TabsTrigger>
            <TabsTrigger value="badges">Badges</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-6 space-y-8">
            {/* 1. Buttons Section */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-lg font-semibold tracking-tight">01. Botones & Acciones</h2>
                <span className="text-xs text-muted-foreground">Shadcn Button Component</span>
              </div>
              <Card>
                <CardContent className="pt-6 flex flex-wrap items-center gap-3">
                  <Button variant="default" size="default">
                    <RiQrCodeLine className="size-4" />
                    Escáner IA
                  </Button>

                  <Button variant="secondary">
                    <RiSearchLine className="size-4" />
                    Buscar Alimento
                  </Button>

                  <Button variant="outline">
                    <RiCalendarLine className="size-4" />
                    Filtrar Fecha
                  </Button>

                  <Button variant="ghost" size="icon">
                    <RiAddLine className="size-4" />
                  </Button>

                  <Button variant="destructive" size="sm">
                    Eliminar
                  </Button>
                </CardContent>
              </Card>
            </section>

            {/* 2. Cards & Surfaces Section */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-lg font-semibold tracking-tight">02. Tarjetas & Superficies Nutricionales</h2>
                <span className="text-xs text-muted-foreground">Shadcn Card System</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-base">Pechuga de Pollo Ariztía</CardTitle>
                        <CardDescription className="text-xs">200g (1.0 porción)</CardDescription>
                      </div>
                      <Badge variant="secondary">330 kcal</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Proteínas:</span>
                      <span className="font-mono font-medium text-foreground">62.0g</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Carbohidratos:</span>
                      <span className="font-mono font-medium text-foreground">0.0g</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Grasas Totales:</span>
                      <span className="font-mono font-medium text-foreground">7.2g</span>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button variant="ghost" size="sm" className="w-full text-xs">
                      Ver Desglose Completo
                    </Button>
                  </CardFooter>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-base">Resumen Energético Diario</CardTitle>
                        <CardDescription className="text-xs">Meta: 2,200 kcal</CardDescription>
                      </div>
                      <RiFireLine className="size-5 text-amber-500" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-3xl font-bold font-mono">1,840</span>
                      <span className="text-xs text-muted-foreground font-mono">83.6% alcanzado</span>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-4 gap-1 text-center font-mono text-xs">
                      <div className="p-1.5 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground">PROT</p>
                        <p className="font-semibold">128g</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground">CARB</p>
                        <p className="font-semibold">190g</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground">FAT</p>
                        <p className="font-semibold">52g</p>
                      </div>
                      <div className="p-1.5 rounded bg-muted/50">
                        <p className="text-[10px] text-muted-foreground">FIB</p>
                        <p className="font-semibold">26g</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* 3. Badges & Chilean Seals */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-lg font-semibold tracking-tight">03. Badges & Octágonos Ley Chilena</h2>
                <span className="text-xs text-muted-foreground">Shadcn Badge + Custom Octagons</span>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">Default Badge</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="outline">Outline</Badge>
                    <Badge variant="destructive">Destructive</Badge>
                  </div>
                  <Separator />
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sellos de Advertencia Chilenos (MINSAL):</Label>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 bg-black text-white text-[10px] font-extrabold px-2 py-1 rounded border border-white uppercase tracking-tight">
                        <RiShieldLine className="size-3" />
                        ALTO EN SODIO
                      </span>
                      <span className="inline-flex items-center gap-1 bg-black text-white text-[10px] font-extrabold px-2 py-1 rounded border border-white uppercase tracking-tight">
                        <RiShieldLine className="size-3" />
                        ALTO EN AZÚCARES
                      </span>
                      <span className="inline-flex items-center gap-1 bg-black text-white text-[10px] font-extrabold px-2 py-1 rounded border border-white uppercase tracking-tight">
                        <RiShieldLine className="size-3" />
                        ALTO EN CALORÍAS
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* 4. Inputs & Forms */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b pb-2">
                <h2 className="text-lg font-semibold tracking-tight">04. Inputs & Controles de Formulario</h2>
                <span className="text-xs text-muted-foreground">Shadcn Input Component</span>
              </div>
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="food-search">Búsqueda de Alimentos</Label>
                    <div className="relative">
                      <RiSearchLine className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                      <Input
                        id="food-search"
                        placeholder="Buscar por nombre o marca (ej. Soprole, Ariztía)..."
                        className="pl-9"
                        defaultValue="Yogurt Protein Soprole"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <footer className="text-center text-xs text-muted-foreground pt-8 border-t">
          Balance Monorepo — Built with Shadcn preset b6YqzcHxSM, Tailwind CSS v4 and Base UI.
        </footer>
      </div>
    </div>
  )
}

export default App
