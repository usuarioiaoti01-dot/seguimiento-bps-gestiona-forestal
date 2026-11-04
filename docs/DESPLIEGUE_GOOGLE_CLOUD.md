# Despliegue en Google Cloud (Cloud Run + Cloud SQL para SQL Server)

Guía para publicar la aplicación con HTTPS y base de datos administrada. Los comandos son de `gcloud` (bash; se
pueden ejecutar desde **Cloud Shell**). Reemplace los valores entre `<...>`.

> **Antes de empezar.** Esta guía no se ha ejecutado de punta a punta. Los pasos marcados con ⚠️ no se pudieron
> confirmar en la documentación de Google y deben comprobarse la primera vez. El apartado 11 los resume.

## 0. Arquitectura

```
Usuarios ──HTTPS──► Cloud Run (imagen del Dockerfile)
                        │  Direct VPC egress (solo rangos privados)
                        ▼
                  Cloud SQL para SQL Server (solo IP privada, TCP 1433)
Cloud Run ──internet──► api.anthropic.com (asistente de IA)
```

- **No hay conexión por socket Unix** para SQL Server: se conecta por TCP a la **IP privada** de la instancia,
  usando **Direct VPC egress** (opción que Google recomienda frente al conector de VPC).
- `--vpc-egress=private-ranges-only` deja que el tráfico a `api.anthropic.com` salga directo a internet; con
  `all-traffic` haría falta Cloud NAT.

## 1. Requisitos

- Proyecto de Google Cloud con **facturación activa** y permisos de propietario o equivalentes.
- Cloud SQL para SQL Server tiene costo mensual por instancia y licencia; revise la calculadora de precios de Google
  antes de crearla. Cloud Run cobra por uso.
- Datos de la aplicación (nombres de consultores, contratos) saldrán de la red institucional: confirme que la
  política de la entidad lo permite.

## 2. Variables y APIs

```bash
export PROJECT_ID=<proyecto>
export REGION=<región, p. ej. southamerica-east1>   # la misma para Cloud Run, la subred y Cloud SQL
export RED=default            # nombre de la red VPC (compruebe con: gcloud compute networks list)
export SUBRED=default         # subred de esa red en $REGION, IPv4 /26 o mayor
export INSTANCIA=sgf-sqlserver
export SERVICIO=sgf-seguimiento

gcloud config set project $PROJECT_ID

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  sqladmin.googleapis.com compute.googleapis.com servicenetworking.googleapis.com secretmanager.googleapis.com
```

Direct VPC egress usa el rol *Cloud Run Service Agent*, que ya incluye los permisos necesarios. Si su organización
restringe permisos, otorgue `roles/compute.networkUser` al agente `service-<NÚMERO_PROYECTO>@serverless-robot-prod.iam.gserviceaccount.com`.

## 3. Cloud SQL con IP privada

```bash
# 3.1 Rango para el peering de servicios privados (una sola vez por red)
gcloud compute addresses create google-managed-services-$RED \
  --global --purpose=VPC_PEERING --prefix-length=16 \
  --network=projects/$PROJECT_ID/global/networks/$RED

# 3.2 Conexión de servicios privados
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-$RED --network=$RED

# 3.3 Instancia (sin IP pública)
gcloud beta sql instances create $INSTANCIA \
  --region=$REGION \
  --database-version=SQLSERVER_2019_STANDARD --tier=db-custom-2-7680 \
  --root-password='<clave-fuerte-del-usuario-sqlserver>' \
  --network=projects/$PROJECT_ID/global/networks/$RED \
  --no-assign-ip --enforce-new-sql-network-architecture
```

⚠️ `--database-version` y `--tier` figuran en la documentación solo en Terraform/REST; confirme los nombres vigentes
(puede existir una versión más reciente que 2019) y, si `gcloud` lo pide, agregue `--edition`.

Anote la IP privada, que será `SQL_SERVIDOR`:

```bash
gcloud sql instances describe $INSTANCIA --format="value(ipAddresses[0].ipAddress)"
```

## 4. Base de datos, usuario y scripts

La aplicación necesita la base `SGF_SEGUIMIENTO` (intercalación `Modern_Spanish_CI_AS`), los scripts `db/01` a
`db/05` y un usuario con el rol `sgf_app` (README §2).

```bash
gcloud sql databases create SGF_SEGUIMIENTO --instance=$INSTANCIA --collation=Modern_Spanish_CI_AS
```

⚠️ Confirme que `--collation` existe en su versión de `gcloud`; si no, cree la base desde SSMS con
`CREATE DATABASE SGF_SEGUIMIENTO COLLATE Modern_Spanish_CI_AS;`.

**Cómo ejecutar los scripts.** Con solo IP privada la instancia no es alcanzable desde su PC. Opciones:

1. **Máquina virtual en la misma red** (Compute Engine, acceso por IAP) con Node.js 22, el repositorio clonado y
   un `.env` temporal. Es la opción que mantiene la base cerrada.
2. ⚠️ **IP pública temporal**: asignar IP pública a la instancia, autorizar solo la IP de quien instala, ejecutar y
   volver a quitarla. No se verificó el procedimiento exacto.

Con acceso a la base, desde la carpeta del proyecto y un `.env` con `MODO_DATOS=sqlserver`, `SQL_SERVIDOR`,
`SQL_USUARIO` y `SQL_CLAVE` de un usuario con permisos de instalación:

```bash
npm install
npm run bd:probar      # verifica conexión, versión, compatibilidad y permisos
npm run bd:instalar    # instala db/01–05 en la base vacía
```

⚠️ `db/03_seguridad.sql` crea roles y trae una plantilla de login. Cloud SQL limita lo que puede hacer el usuario
`sqlserver`; si `CREATE LOGIN` falla, cree el usuario `usr_sgf_app` desde la consola o con
`gcloud sql users create usr_sgf_app --instance=$INSTANCIA --password=...` y agréguelo al rol `sgf_app` en la base.

**No** use el usuario administrador de la instancia como `SQL_USUARIO` de la aplicación: use `usr_sgf_app`.

## 5. Secretos

```bash
printf '%s' "$(openssl rand -hex 32)"  | gcloud secrets create sgf-sesion-secreto --data-file=-
printf '%s' '<clave-de-usr_sgf_app>'   | gcloud secrets create sgf-sql-clave --data-file=-
printf '%s' '<clave-inicial-temporal>' | gcloud secrets create sgf-admin-clave --data-file=-
printf '%s' '<ANTHROPIC_API_KEY>'      | gcloud secrets create sgf-anthropic-key --data-file=-

# La cuenta de servicio del servicio Cloud Run debe poder leerlos (por defecto, la de Compute Engine)
CUENTA=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")-compute@developer.gserviceaccount.com
for s in sgf-sesion-secreto sgf-sql-clave sgf-admin-clave sgf-anthropic-key; do
  gcloud secrets add-iam-policy-binding $s --member="serviceAccount:$CUENTA" --role="roles/secretmanager.secretAccessor"
done
```

Nunca ponga estos valores en el repositorio (es público), en `--set-env-vars` ni en el historial del terminal.

## 6. Desplegar

Desde la raíz del proyecto (Cloud Build usa el `Dockerfile`):

```bash
gcloud run deploy $SERVICIO --source . --region $REGION \
  --network=$RED --subnet=$SUBRED --vpc-egress=private-ranges-only \
  --max-instances=1 \
  --allow-unauthenticated \
  --set-env-vars="MODO_DATOS=sqlserver,SQL_SERVIDOR=<IP-privada>,SQL_BASE=SGF_SEGUIMIENTO,SQL_USUARIO=usr_sgf_app,TRUST_PROXY=1,COOKIE_SEGURA=true,NODE_ENV=production,ADMIN_CORREO=<correo-admin>" \
  --set-secrets="SESION_SECRETO=sgf-sesion-secreto:latest,SQL_CLAVE=sgf-sql-clave:latest,ADMIN_CLAVE_INICIAL=sgf-admin-clave:latest,ANTHROPIC_API_KEY=sgf-anthropic-key:latest"
```

Puntos clave:

| Opción | Por qué |
|---|---|
| `TRUST_PROXY=1` | Cloud Run es un proxy delante de la aplicación. Sin esto el límite de intentos de ingreso ve una sola IP para todos y un usuario puede bloquear a los demás. |
| `COOKIE_SEGURA=true` | La sesión viaja solo por HTTPS. |
| `--max-instances=1` | La aplicación guarda en memoria una caché de datos y el contador de intentos de ingreso. Con varias instancias, una vería datos desactualizados tras un cambio hecho en otra. (Deducido del código; revise si más adelante necesita escalar.) |
| `--vpc-egress=private-ranges-only` | Solo el tráfico a la IP privada de la base pasa por la VPC. |
| `--allow-unauthenticated` | Permite que cualquiera llegue a la pantalla de ingreso; el acceso lo controla la propia aplicación (clave y roles). Si su organización lo bloquea, vea el apartado 8. |

La primera vez la aplicación crea el administrador con `ADMIN_CORREO` y la clave temporal, y pide cambiarla al ingresar.

## 7. Verificar

```bash
gcloud run services describe $SERVICIO --region $REGION --format="value(status.url)"
gcloud run services logs read $SERVICIO --region $REGION --limit=50
```

1. Abra la URL: debe aparecer la pantalla de ingreso con HTTPS.
2. Ingrese con el administrador y cambie la clave. En los registros debe verse `datos: sqlserver`.
3. Haga un cambio de avance en una actividad y confirme que queda en la bitácora.
4. La conexión a la base puede tardar un minuto en el arranque en frío (limitación documentada de Direct VPC egress).

## 8. Quién puede entrar

- La URL pública solo expone el ingreso con clave; los datos requieren sesión y rol (ADMIN, EDITOR, LECTOR).
- Para limitarla más, alternativas de Google: **Identity-Aware Proxy** delante del servicio, o el inicio de sesión con
  Google Workspace (pendiente del backlog de `CLAUDE.md`).
- Cree solo las cuentas necesarias y asigne el rol mínimo.

## 9. Actualizar la aplicación

Después de cambiar el código y aprobar `npm test` (GitHub Actions lo ejecuta en cada push), vuelva a ejecutar el
comando del apartado 6; las variables y secretos se conservan en la revisión nueva. Los cambios de estructura de la
base van en scripts nuevos `db/NN_*.sql` (regla 1 de `CLAUDE.md`) y se ejecutan antes de desplegar.

## 10. Costos y limpieza

- Para pausar costos: `gcloud sql instances patch $INSTANCIA --activation-policy=NEVER` (detiene la instancia).
- Para eliminar todo: `gcloud run services delete $SERVICIO --region $REGION` y
  `gcloud sql instances delete $INSTANCIA` (irreversible: respalde antes).
- Active los respaldos automáticos de Cloud SQL antes de usar datos reales.

## 11. Lo que falta confirmar la primera vez

Verificado en la documentación de Google: conexión por IP privada y TCP 1433, Direct VPC egress (flags, subred
IPv4 /26 o mayor, rol del agente de servicio), APIs y comandos para crear la instancia con IP privada.

Sin verificar (⚠️): nombres vigentes de `--database-version`/`--tier`/`--edition`; `--collation` al crear la base;
cómo ejecutar los scripts con IP privada (VM o IP pública temporal); si `CREATE LOGIN` de `db/03_seguridad.sql`
funciona con el usuario de Cloud SQL; el efecto exacto de `--max-instances=1` con la carga real.
