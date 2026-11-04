/* =====================================================================
   07_perfiles_usuario.sql – Perfiles de usuario y cuentas de profesionales
   Idempotente: se puede ejecutar más de una vez.

   Perfiles (sgf.usuario.rol):
     ADMIN          Administrador: acceso total; crea usuarios y modifica perfiles.
     JEFE_PROYECTO  Jefe de Proyecto: todo, menos crear usuarios y modificar perfiles.
     PROFESIONAL    Solo su propia información (ficha); modifica estado y avance de sus actividades.
                    Cada cuenta se vincula a un consultor (sgf.usuario.consultor_id; una cuenta por consultor).

   Migración: EDITOR pasa a JEFE_PROYECTO. LECTOR deja de existir como perfil: esas cuentas quedan
   como PROFESIONAL inactivas y sin vínculo (se reactivan vinculándolas a un consultor).
   Las cuentas de los profesionales se crean desde la aplicación (Configuración → Usuarios), porque
   la clave inicial de cada una se genera allí y no puede estar en un script.
   Instalación: después de 04 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- 1. Vínculo de la cuenta con el profesional
IF COL_LENGTH('sgf.usuario', 'consultor_id') IS NULL
    ALTER TABLE sgf.usuario ADD consultor_id INT NULL CONSTRAINT FK_usuario_consultor REFERENCES sgf.consultor (consultor_id);
GO

-- 2. Se retira la restricción antigua de perfiles y se ensancha la columna (PROFESIONAL y JEFE_PROYECTO no caben en 10)
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_usuario_rol' AND parent_object_id = OBJECT_ID('sgf.usuario') AND definition NOT LIKE '%PROFESIONAL%')
    ALTER TABLE sgf.usuario DROP CONSTRAINT CK_usuario_rol;
GO
IF (SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('sgf.usuario') AND name = 'rol') < 20
    ALTER TABLE sgf.usuario ALTER COLUMN rol VARCHAR(20) NOT NULL;
GO

-- 3. Migración de las cuentas existentes
DECLARE @editores INT, @lectores INT;
UPDATE sgf.usuario SET rol = 'JEFE_PROYECTO' WHERE rol = 'EDITOR';
SET @editores = @@ROWCOUNT;
UPDATE sgf.usuario SET rol = 'PROFESIONAL', activo = 0, consultor_id = NULL WHERE rol = 'LECTOR';
SET @lectores = @@ROWCOUNT;
IF @editores + @lectores > 0
    INSERT INTO sgf.bitacora (usuario, entidad, accion, cambios_json, motivo, origen)
    VALUES (N'sistema', 'usuario', 'MODIFICAR',
            N'{"editor_a_jefe_proyecto":' + CAST(@editores AS NVARCHAR(10)) + N',"lector_a_profesional_inactivo":' + CAST(@lectores AS NVARCHAR(10)) + N'}',
            N'Migración de perfiles (07_perfiles_usuario.sql)', 'SCRIPT');
GO

-- 4. Restricciones nuevas
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_usuario_rol' AND parent_object_id = OBJECT_ID('sgf.usuario'))
    ALTER TABLE sgf.usuario ADD CONSTRAINT CK_usuario_rol CHECK (rol IN ('ADMIN', 'JEFE_PROYECTO', 'PROFESIONAL'));
GO
-- Un PROFESIONAL activo debe estar vinculado a un consultor; los demás perfiles no se vinculan.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_usuario_profesional' AND parent_object_id = OBJECT_ID('sgf.usuario'))
    ALTER TABLE sgf.usuario ADD CONSTRAINT CK_usuario_profesional CHECK (
        (rol = 'PROFESIONAL' AND (consultor_id IS NOT NULL OR activo = 0)) OR (rol <> 'PROFESIONAL' AND consultor_id IS NULL));
GO
-- Una sola cuenta por consultor
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_usuario_consultor' AND object_id = OBJECT_ID('sgf.usuario'))
    CREATE UNIQUE INDEX UX_usuario_consultor ON sgf.usuario (consultor_id) WHERE consultor_id IS NOT NULL;
GO
